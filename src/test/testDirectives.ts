import { assert } from 'chai';
import {
  makeExecutableSchema,
} from '../schemaGenerator';
import {
  VisitableType,
  SchemaDirectiveVisitor,
} from '../directives';
import {
  GraphQLObjectType,
  GraphQLEnumType,
  GraphQLField,
  GraphQLArgument,
  GraphQLEnumValue,
  GraphQLInputObjectType,
  GraphQLInputField,
} from 'graphql';

const typeDefs = `
directive @schemaDirective(role: String) on SCHEMA
directive @enumValueDirective on ENUM_VALUE

schema @schemaDirective(role: "admin") {
  query: Query
  mutation: Mutation
}

type Query @queryTypeDirective {
  people: [Person] @queryFieldDirective
}

enum Gender @enumTypeDirective {
  NONBINARY @enumValueDirective
  FEMALE
  MALE
}

interface Named @interfaceDirective {
  name: String! @interfaceFieldDirective
}

input PersonInput @inputTypeDirective {
  name: String! @inputFieldDirective
  gender: Gender
}

type Mutation @mutationTypeDirective {
  addPerson(
    input: PersonInput @mutationArgumentDirective
  ): Person @mutationMethodDirective
}

type Person implements Named @objectTypeDirective {
  id: ID! @objectFieldDirective
  name: String!
}

union WhateverUnion @unionDirective = Person | Query | Mutation
`;

describe('@directives', () => {
  it('are included in the schema AST', () => {
    const schema = makeExecutableSchema({
      typeDefs,
    });

    function checkDirectives(
      type: VisitableType,
      typeDirectiveNames: [string],
      fieldDirectiveMap: { [key: string]: string[] } = {},
    ) {
      assert.deepEqual(
        getDirectiveNames(type),
        typeDirectiveNames,
      );

      Object.keys(fieldDirectiveMap).forEach(key => {
        assert.deepEqual(
          getDirectiveNames((type as GraphQLObjectType).getFields()[key]),
          fieldDirectiveMap[key],
        );
      });
    }

    function getDirectiveNames(
      type: VisitableType,
    ): string[] {
      return type.astNode.directives.map(d => d.name.value);
    }

    assert.deepEqual(
      getDirectiveNames(schema),
      ['schemaDirective'],
    );

    checkDirectives(schema.getQueryType(), ['queryTypeDirective'], {
      people: ['queryFieldDirective'],
    });

    assert.deepEqual(
      getDirectiveNames(schema.getType('Gender')),
      ['enumTypeDirective'],
    );

    const nonBinary = (schema.getType('Gender') as GraphQLEnumType).getValues()[0];
    assert.deepEqual(
      getDirectiveNames(nonBinary),
      ['enumValueDirective'],
    );

    checkDirectives(schema.getType('Named'), ['interfaceDirective'], {
      name: ['interfaceFieldDirective'],
    });

    checkDirectives(schema.getType('PersonInput'), ['inputTypeDirective'], {
      name: ['inputFieldDirective'],
      gender: [],
    });

    checkDirectives(schema.getMutationType(), ['mutationTypeDirective'], {
      addPerson: ['mutationMethodDirective'],
    });
    assert.deepEqual(
      getDirectiveNames(schema.getMutationType().getFields().addPerson.args[0]),
      ['mutationArgumentDirective'],
    );

    checkDirectives(schema.getType('Person'), ['objectTypeDirective'], {
      id: ['objectFieldDirective'],
      name: [],
    });

    checkDirectives(schema.getType('WhateverUnion'), ['unionDirective']);
  });

  it('can be implemented with SchemaDirectiveVisitor', () => {
    const visited: Set<GraphQLObjectType> = new Set;
    const schema = makeExecutableSchema({ typeDefs });
    let visitCount = 0;

    SchemaDirectiveVisitor.visitSchema(schema, {
      // The directive subclass can be defined anonymously inline!
      queryTypeDirective: class extends SchemaDirectiveVisitor {
        public static description = 'A @directive for query object types';
        public visitObject(object: GraphQLObjectType) {
          visited.add(object);
          visitCount++;
        }
      },
    });

    assert.strictEqual(visited.size, 1);
    assert.strictEqual(visitCount, 1);
    visited.forEach(object => {
      assert.strictEqual(object, schema.getType('Query'));
    });
  });

  it('can visit fields within object types', () => {
    const schema = makeExecutableSchema({ typeDefs });

    let mutationObjectType: GraphQLObjectType;
    let mutationField: GraphQLField<any, any>;
    let enumObjectType: GraphQLEnumType;
    let inputObjectType: GraphQLInputObjectType;

    SchemaDirectiveVisitor.visitSchema(schema, {
      mutationTypeDirective: class extends SchemaDirectiveVisitor {
        public visitObject(object: GraphQLObjectType) {
          mutationObjectType = object;
          assert.strictEqual(object.name, 'Mutation');
        }
      },

      mutationMethodDirective: class extends SchemaDirectiveVisitor {
        public visitFieldDefinition(field: GraphQLField<any, any>, details: {
          objectType: GraphQLObjectType,
        }) {
          assert.strictEqual(field.name, 'addPerson');
          assert.strictEqual(details.objectType, mutationObjectType);
          assert.strictEqual(field.args.length, 1);
          mutationField = field;
        }
      },

      mutationArgumentDirective: class extends SchemaDirectiveVisitor {
        public visitArgumentDefinition(arg: GraphQLArgument, details: {
          field: GraphQLField<any, any>,
          objectType: GraphQLObjectType,
        }) {
          assert.strictEqual(arg.name, 'input');
          assert.strictEqual(details.field, mutationField);
          assert.strictEqual(details.objectType, mutationObjectType);
          assert.strictEqual(details.field.args[0], arg);
        }
      },

      enumTypeDirective: class extends SchemaDirectiveVisitor {
        public visitEnum(enumType: GraphQLEnumType) {
          assert.strictEqual(enumType.name, 'Gender');
          enumObjectType = enumType;
        }
      },

      enumValueDirective: class extends SchemaDirectiveVisitor {
        public visitEnumValue(value: GraphQLEnumValue, details: {
          enumType: GraphQLEnumType,
        }) {
          assert.strictEqual(value.name, 'NONBINARY');
          assert.strictEqual(value.value, 'NONBINARY');
          assert.strictEqual(details.enumType, enumObjectType);
        }
      },

      inputTypeDirective: class extends SchemaDirectiveVisitor {
        public visitInputObject(object: GraphQLInputObjectType) {
          inputObjectType = object;
          assert.strictEqual(object.name, 'PersonInput');
        }
      },

      inputFieldDirective: class extends SchemaDirectiveVisitor {
        public visitInputFieldDefinition(field: GraphQLInputField, details: {
          objectType: GraphQLInputObjectType,
        }) {
          assert.strictEqual(field.name, 'name');
          assert.strictEqual(details.objectType, inputObjectType);
        }
      }
    });
  });
});